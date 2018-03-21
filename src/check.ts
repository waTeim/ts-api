const Promise = require('bluebird');
const fs = require('fs');
const path = require('path');

function getOutDir() {
  let tsconfigPath = path.resolve('tsconfig.json');
  let stats = fs.statSync(tsconfigPath);
  let outDir = null;

  if(stats != null) {
    if(stats.isFile()) {
      let data = fs.readFileSync(tsconfigPath);

      try {
        let tsMeta = JSON.parse(data);

        if(tsMeta != null && tsMeta.compilerOptions != null && tsMeta.compilerOptions.outDir != null)
          outDir = path.resolve(tsMeta.compilerOptions.outDir);
      }
      catch(e) {}
    }
  }
  return outDir;
}

let outDir = getOutDir();

const check = require(path.resolve(outDir,'__check.js'));

function GET(p1,p2,p3) {
   return function(target:Object,key:string,descriptor:TypedPropertyDescriptor<any>) {
      let checkObject = check[(<any>target.constructor).name + "." + key];


      if(descriptor === undefined) descriptor = Object.getOwnPropertyDescriptor(target, key);

      let originalMethod = descriptor.value;

      descriptor.value = function () {
        let valid = checkObject.validate(checkObject.argsToSchema(arguments));
        var args = [];

        if(!valid) {
          let err = checkObject.validate.errors[0];

          throw("parameterList" + err.dataPath + " " + err.message);
        }


        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i - 0] = arguments[_i];
        }
        // note usage of originalMethod here
        var result = originalMethod.apply(this, args);
        return result;
      };
      return descriptor;
   };
}

module.exports = {
  GET:GET
}
