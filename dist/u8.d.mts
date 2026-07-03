declare function encode(o: any): Uint8Array<ArrayBuffer>;
declare function decode(uint8Array: Uint8Array): any;
declare function clone<T>(o: T): T;

export { clone, decode, encode };
