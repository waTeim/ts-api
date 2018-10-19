import "reflect-metadata";

export default function urlParam(component:string) {
  return function(target:any,propertyKey:string|symbol,parameterIndex:number):void {
    const parms = Reflect.getOwnMetadata("urlParam",target,propertyKey) || [];
 
    parms.push(parameterIndex);
    Reflect.defineMetadata("urlParam",parms,target,propertyKey);
  }
}
