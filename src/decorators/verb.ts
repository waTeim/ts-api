const Promise = require('bluebird');

/**
 * A decorator for REST endpoints.  Use the typescript decorator system to 
 * automatically apply typechecking.  Assume that the controller for which this
 * decorator applies to it's methods follows the form defined by ControllerBase
 * and itself hase been annotated by @controller.  If that is true, then a reference
 * to that controller class will be provided to an argument to this function.  Use
 * the controller reference to gain access to the function that defines the check as
 * well as the JSON schema to use as an argument.  Return a function that will first 
 * perform that check, and if the check passes then execute the method on which this
 * decorator has been applied.  Otherwise throw an error.  Assume that the exception
 * will be caught appropriately -- it will because this function will be invoked in the
 * context of analogously renerated file __routes.js. Provide for the possibility
 * of a user defined function for error processing which can itself either return 
 * a status code or throw an error.
 *
 * @param {any} target reference to containing class of the decorated method
 * @param {string} key the method name
 * @param {any} originalMethod reference to the decorated method
 * @param {Function} errorHandler A user defined error handler.
 */
export default function verb(target:any,key:string,originalMethod:any,errorHandler:Function) {
  return function() {
    let binding = this.getEndpointSignatureBinding();
    let controller = this;
    let args = [];

    if(binding != null) {
      let check = binding.check[(<any>target.constructor).name + "." + key];
      let argObject = check.argsToSchema(arguments);
      let valid = check.validate(argObject);

      if(!valid) {
        let err = check.validate.errors[0];

        throw({ status:400, message:"parameterList" + err.dataPath + " " + err.message });
       }
   
       // generate args from schema because ajv might have transformed the original
       args = check.schemaToArgs(argObject);
    }
    else {
      for(var i = 0;i < arguments.length;i++) args[i - 0] = arguments[i];
    }
    try {
      // note usage of originalMethod here
      let obj = originalMethod.apply(controller,args);

      // If the original method is async, then resolve the promise before returning
      if(obj != null) {
        if(obj.constructor.name == 'Promise') {
          let promise = new Promise(function(resolve,reject) {

            obj.then(
              function(value) { resolve(value) },
              function(reason) { 
                if(errorHandler != null) {
                  try {
                    let properties = controller.getProperties();
                    let errorHandlerResult = errorHandler(reason,properties.req,properties.res,properties.next);

                    if(errorHandlerResult != null && typeof errorHandlerResult == "object") {
                      if(errorHandlerResult.status == null) errorHandlerResult.status = 500;
                      reject(errorHandlerResult);
                    }
                    else reject({ status:500, message:errorHandlerResult });
                  }
                  catch(e) { reject(e); }
                }
                else {
                  if(typeof reason == 'object') reason.status = 500;
                  reject(reason);
                }
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
        let properties = controller.getProperties();
        let errorHandlerResult = errorHandler(e,properties.req,properties.res,properties.next);

        if(errorHandlerResult != null && typeof errorHandlerResult == "object") {
          if(errorHandlerResult.status == null) errorHandlerResult.status = 500;
          throw(errorHandlerResult);
        }
        else throw({ status:500, message:errorHandlerResult });
      }
      throw(e);
    }
  }
}
