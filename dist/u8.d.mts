declare function encode(o: any): Uint8Array<ArrayBuffer>;
declare function decode(uint8Array: any): any;
declare function clone(o: any): any;

export { clone, decode, encode };
