import verb from "./verb";

export default function put(path?:string,errorHandler?:Function) {
  return function(target:any,key:string,descriptor:TypedPropertyDescriptor<any>) {
    if(descriptor === undefined) descriptor = Object.getOwnPropertyDescriptor(target,key);
    descriptor.value = verb(target,key,descriptor.value,errorHandler);
    return descriptor;
  }
}
