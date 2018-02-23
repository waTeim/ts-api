var check = require('__check.js');
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