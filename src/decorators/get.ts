const Promise = require('bluebird');
const uuid = require('uuid/v1');

export default function get(path?:string,errorHandler?:Function) {
  return function(target:any,key:string,descriptor:TypedPropertyDescriptor<any>) {
    if(descriptor === undefined) descriptor = Object.getOwnPropertyDescriptor(target,key);

    let originalMethod = descriptor.value;

    descriptor.value = function () {
      let binding = this.getEndpointSignatureBinding();
      let controller = this;
     
      if(binding != null) {
        let check = binding.check[(<any>target.constructor).name + "." + key];
        let valid = check.validate(check.argsToSchema(arguments));
        var args = [];


        if(!valid) {
          let err = check.validate.errors[0];

          throw({ status:400, message:"parameterList" + err.dataPath + " " + err.message });
         }
      }
      for(var _i = 0;_i < arguments.length;_i++) args[_i - 0] = arguments[_i];
      try {
        // note usage of originalMethod here
        let obj = originalMethod.apply(this,args);

        if(obj != null) {
          if(obj.constructor.name == 'Promise') {
            let promise = new Promise(function(resolve,reject) {

              obj.then(
                function(value) { resolve(value) },
                function(reason) { 
                  if(errorHandler != null) {
                    try {
                      let errorHandlerResult = errorHandler(reason,controller.req,controller.res,controller.next);

                      if(errorHandlerResult != null && typeof errorHandlerResult == "object") {
                        if(errorHandlerResult.status == null) errorHandlerResult.status = 500;
                        reject(errorHandlerResult);
                      }
                      else reject({ status:500, message:errorHandlerResult });
                    }
                    catch(e) { reject(e); }
                  }
                  else reject(reason);
                }
              );
            });

            return promise;
          }
        }
        return new Promise(function(resolve,reject) { resolve(obj); });
      }
      catch(e) {
        if(errorHandler != null) {
          let errorHandlerResult = errorHandler(e,controller.req,controller.res,controller.next);

          if(errorHandlerResult != null && typeof errorHandlerResult == "object") {
            if(errorHandlerResult.status == null) errorHandlerResult.status = 500;
            throw(errorHandlerResult);
          }
          else throw({ status:500, message:errorHandlerResult });
        }
        throw(e);
      }
    }

    return descriptor;
  }
}
