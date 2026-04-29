import { describe, expect, it, vi } from 'vitest';

import { clone, decode, encode } from '../u8.ts';

type TypedArray =
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array;

type TypedArrayConstructor = {
  new (values: ArrayLike<number> | ArrayBufferLike): TypedArray;
  new (buffer: ArrayBufferLike, byteOffset: number, length?: number): TypedArray;
  BYTES_PER_ELEMENT: number;
  name: string;
};

const typedArrayConstructors: TypedArrayConstructor[] = [
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array,
];

const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer;

const isTypedArray = (value: unknown): value is TypedArray =>
  ArrayBuffer.isView(value) && !(value instanceof DataView);

const bytesOf = (value: ArrayBuffer | ArrayBufferView): number[] => {
  if (isArrayBuffer(value)) {
    return Array.from(new Uint8Array(value));
  }
  return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
};

const expectTransparent = (actual: unknown, expected: unknown): void => {
  if (isArrayBuffer(expected)) {
    expect(actual).toBeInstanceOf(ArrayBuffer);
    expect(bytesOf(actual as ArrayBuffer)).toEqual(bytesOf(expected));
    return;
  }

  if (isTypedArray(expected)) {
    expect(actual).toBeInstanceOf(expected.constructor);
    expect(bytesOf(actual as TypedArray)).toEqual(bytesOf(expected));
    expect((actual as TypedArray).length).toBe(expected.length);
    return;
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expectTransparent((actual as unknown[])[i], expected[i]);
    }
    return;
  }

  if (expected && typeof expected === 'object') {
    expect(actual).not.toBeNull();
    expect(typeof actual).toBe('object');
    const expectedKeys = Object.keys(expected);
    expect(Object.keys(actual as Record<string, unknown>)).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expectTransparent(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
      );
    }
    return;
  }

  expect(actual).toBe(expected);
};

const roundTrip = <T>(value: T): unknown => decode(encode(value));

const makeArrayBuffer = (values: number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(values.length);
  new Uint8Array(buffer).set(values);
  return buffer;
};

const makeOffsetView = <T extends TypedArray>(
  Constructor: TypedArrayConstructor,
  values: number[],
): T => {
  const elementSize = Constructor.BYTES_PER_ELEMENT;
  const prefixElements = 2;
  const suffixElements = 2;
  const buffer = new ArrayBuffer((values.length + prefixElements + suffixElements) * elementSize);
  const fullView = new Constructor(buffer);

  for (let i = 0; i < fullView.length; i++) {
    fullView[i] = i + 17;
  }
  for (let i = 0; i < values.length; i++) {
    fullView[prefixElements + i] = values[i];
  }

  return new Constructor(buffer, prefixElements * elementSize, values.length) as T;
};

const makeWireWithAddendum = (addendumIndex: number, addendumType: number): Uint8Array => {
  const encodedJson = new TextEncoder().encode('null');
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  view.setUint32(offset, encodedJson.byteLength, true);
  offset += 4;
  bytes.set(encodedJson, offset);
  offset += 4;
  view.setUint32(offset, 1, true);
  offset += 4;
  view.setUint32(offset, addendumIndex, true);
  offset += 4;
  view.setUint32(offset, addendumType, true);
  offset += 4;
  view.setUint32(offset, 0, true);

  return bytes;
};

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const createFuzzValue = (random: () => number, depth = 0): unknown => {
  const maxDepth = 4;
  const choice = Math.floor(random() * (depth >= maxDepth ? 7 : 10));

  switch (choice) {
    case 0:
      return null;
    case 1:
      return undefined;
    case 2:
      return random() < 0.5;
    case 3:
      return Math.floor(random() * 2000) - 1000;
    case 4:
      return `str-${Math.floor(random() * 1000)}-\u2603`;
    case 5:
      return new Uint8Array([
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        Math.floor(random() * 256),
      ]);
    case 6:
      return makeArrayBuffer([
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        Math.floor(random() * 256),
      ]);
    case 7: {
      const length = Math.floor(random() * 5);
      return Array.from({ length }, () => createFuzzValue(random, depth + 1));
    }
    case 8: {
      const length = Math.floor(random() * 5);
      const object: Record<string, unknown> = {};
      for (let i = 0; i < length; i++) {
        object[`key_${depth}_${i}`] = createFuzzValue(random, depth + 1);
      }
      return object;
    }
    default: {
      const Constructor = typedArrayConstructors[
        Math.floor(random() * typedArrayConstructors.length)
      ];
      const length = Math.floor(random() * 5);
      return new Constructor(
        Array.from({ length }, () => Math.floor(random() * 32) - 16),
      );
    }
  }
};

describe('encode/decode round trips', () => {
  it('round-trips JSON-compatible primitives and structures', () => {
    const cases: unknown[] = [
      null,
      true,
      false,
      0,
      123.5,
      '',
      'ascii',
      'unicode: hello, \u4e16\u754c, \ud83d\ude80',
      [],
      {},
      [1, 'two', false, null, { nested: ['value'] }],
      {
        nested: {
          array: [1, 2, 3],
          object: { a: 'b' },
          emptyArray: [],
          emptyObject: {},
        },
      },
    ];

    for (const value of cases) {
      expectTransparent(roundTrip(value), value);
    }
  });

  it('preserves undefined at root, object properties, array elements, and nested paths', () => {
    const cases: unknown[] = [
      undefined,
      { value: undefined },
      [undefined],
      {
        a: 1,
        b: undefined,
        c: [2, undefined, { d: undefined }],
      },
    ];

    for (const value of cases) {
      expectTransparent(roundTrip(value), value);
    }
  });

  it.each(typedArrayConstructors)('round-trips %s values', Constructor => {
    const value = new Constructor([0, 1, 2, 127, 255, -1, 65535, 3.5]);

    const decoded = roundTrip(value);

    expectTransparent(decoded, value);
  });

  it('round-trips ArrayBuffer values', () => {
    const value = makeArrayBuffer([0, 1, 2, 3, 254, 255]);

    expectTransparent(roundTrip(value), value);
  });

  it('round-trips mixed binary addendums inside objects and arrays', () => {
    const payload = {
      bytes: new Uint8Array([1, 2, 3]),
      nested: [
        new Int16Array([-1, 0, 1]),
        { buffer: makeArrayBuffer([9, 8, 7, 6]) },
        undefined,
      ],
      floats: new Float64Array([Math.PI, -0, 1.5]),
    };

    expectTransparent(roundTrip(payload), payload);
  });

  it('returns encoded data as a Uint8Array', () => {
    const encoded = encode({ ok: true });

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.byteLength).toBeGreaterThan(0);
  });
});

describe('clone', () => {
  it('matches encode/decode behavior', () => {
    const value = {
      bytes: new Uint8Array([1, 2, 3]),
      nested: { missing: undefined, text: 'hello' },
    };

    expectTransparent(clone(value), value);
  });

  it('does not reuse original binary storage', () => {
    const original = new Uint8Array([1, 2, 3]);
    const copied = clone(original);

    original[0] = 99;

    expectTransparent(copied, new Uint8Array([1, 2, 3]));
  });
});

describe('binary corner cases', () => {
  it('round-trips empty typed arrays and empty ArrayBuffers', () => {
    for (const Constructor of typedArrayConstructors) {
      expectTransparent(roundTrip(new Constructor([])), new Constructor([]));
    }

    expectTransparent(roundTrip(new ArrayBuffer(0)), new ArrayBuffer(0));
  });

  it.each(typedArrayConstructors)('preserves %s non-zero byteOffset views', Constructor => {
    const value = makeOffsetView(Constructor, [5, 6, 7]);

    const decoded = roundTrip(value);

    expectTransparent(decoded, value);
    expect(bytesOf(decoded as TypedArray)).toEqual(bytesOf(value));
  });

  it('handles alignment-sensitive addendum byte lengths', () => {
    const payload = {
      oneByte: new Uint8Array([1]),
      twoBytes: new Uint8Array([1, 2]),
      threeBytes: new Uint8Array([1, 2, 3]),
      fourBytes: new Uint8Array([1, 2, 3, 4]),
      fiveBytes: new Uint8Array([1, 2, 3, 4, 5]),
      buffer: makeArrayBuffer([6, 7, 8]),
    };

    expectTransparent(roundTrip(payload), payload);
  });

  it('decodes from a subarray of a larger backing buffer', () => {
    const value = {
      bytes: new Uint8Array([1, 2, 3]),
      nested: { value: undefined },
    };
    const encoded = encode(value);
    const wrapped = new Uint8Array(encoded.byteLength + 16);
    wrapped.fill(255);
    wrapped.set(encoded, 7);

    const decoded = decode(wrapped.subarray(7, 7 + encoded.byteLength));

    expectTransparent(decoded, value);
  });

  it('grows the reusable text buffer for large JSON payloads', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = { text: 'x'.repeat(4 * 1024 * 1024 + 1) };

    try {
      expectTransparent(roundTrip(value), value);
      expect(warnSpy).toHaveBeenCalledWith('zjs: resizing buffer');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('deterministic fuzz tests', () => {
  it('round-trips generated mixed payloads', () => {
    const random = createPrng(0xc0ffee);

    for (let i = 0; i < 200; i++) {
      const value = createFuzzValue(random);
      expectTransparent(roundTrip(value), value);
    }
  });
});

describe('error behavior', () => {
  it('throws for circular structures', () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => encode(value)).toThrow();
  });

  it('throws for BigInt values', () => {
    expect(() => encode({ value: 1n })).toThrow();
  });

  it('throws for truncated encoded buffers', () => {
    expect(() => decode(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it('throws for unknown addendum type ids', () => {
    expect(() => decode(makeWireWithAddendum(1, 999))).toThrow(
      'failed to find typed array cons for 999',
    );
  });

  it('throws when declared addendums cannot be rebound into the JSON tree', () => {
    expect(() => decode(makeWireWithAddendum(99, 12))).toThrow(
      'did not bind all addendums (bound 0/1)',
    );
  });
});

