const Promise = require('bluebird');
const uuid = require('uuid/v1');

export default function get(p1) {
  return function(target:any,key:string,descriptor:TypedPropertyDescriptor<any>) {
    if(descriptor === undefined) descriptor = Object.getOwnPropertyDescriptor(target,key);

    let originalMethod = descriptor.value;

    descriptor.value = function () {
      let binding = this.getEndpointSignatureBinding();
     
      if(binding != null) {
        let check = binding.check[(<any>target.constructor).name + "." + key];
        let valid = check.validate(check.argsToSchema(arguments));
        var args = [];

        if(!valid) {
          let err = check.validate.errors[0];

          throw("parameterList" + err.dataPath + " " + err.message);
         }
      }
      for(var _i = 0;_i < arguments.length;_i++) args[_i - 0] = arguments[_i];

      // note usage of originalMethod here
      var result = originalMethod.apply(this,args);

      return result;
    }

    return descriptor;
  }
}
