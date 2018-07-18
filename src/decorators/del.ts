import verb from "./verb";

export default function del(path?:string,errorHandler?:Function) {
  return function(target:any,key:string,descriptor:TypedPropertyDescriptor<any>) {
    if(descriptor === undefined) descriptor = Object.getOwnPropertyDescriptor(target,key);
    descriptor.value = verb(target,key,descriptor.value,errorHandler);
    return descriptor;
  }
}
