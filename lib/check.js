var Promise = require('bluebird');
var fs = require('fs');
var path = require('path');
function getOutDir() {
    var tsconfigPath = path.resolve('tsconfig.json');
    var stats = fs.statSync(tsconfigPath);
    var outDir = null;
    if (stats != null) {
        if (stats.isFile()) {
            var data = fs.readFileSync(tsconfigPath);
            try {
                var tsMeta = JSON.parse(data);
                if (tsMeta != null && tsMeta.compilerOptions != null && tsMeta.compilerOptions.outDir != null)
                    outDir = path.resolve(tsMeta.compilerOptions.outDir);
            }
            catch (e) { }
        }
    }
    return outDir;
}
var outDir = getOutDir();
var check = require(path.resolve(outDir, '__check.js'));
function GET(p1, p2, p3) {
    return function (target, key, descriptor) {
        var checkObject = check[target.constructor.name + "." + key];
        if (descriptor === undefined)
            descriptor = Object.getOwnPropertyDescriptor(target, key);
        var originalMethod = descriptor.value;
        descriptor.value = function () {
            var valid = checkObject.validate(checkObject.argsToSchema(arguments));
            var args = [];
            if (!valid) {
                var err = checkObject.validate.errors[0];
                throw ("parameterList" + err.dataPath + " " + err.message);
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
    GET: GET
};
//# sourceMappingURL=check.js.map