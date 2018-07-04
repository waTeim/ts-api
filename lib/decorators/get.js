"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Promise = require('bluebird');
var uuid = require('uuid/v1');
function get(p1) {
    return function (target, key, descriptor) {
        if (descriptor === undefined)
            descriptor = Object.getOwnPropertyDescriptor(target, key);
        var originalMethod = descriptor.value;
        descriptor.value = function () {
            var binding = this.getEndpointSignatureBinding();
            if (binding != null) {
                var check = binding.check[target.constructor.name + "." + key];
                var valid = check.validate(check.argsToSchema(arguments));
                var args = [];
                if (!valid) {
                    var err = check.validate.errors[0];
                    throw ("parameterList" + err.dataPath + " " + err.message);
                }
            }
            for (var _i = 0; _i < arguments.length; _i++)
                args[_i - 0] = arguments[_i];
            // note usage of originalMethod here
            var result = originalMethod.apply(this, args);
            return result;
        };
        return descriptor;
    };
}
exports.default = get;
//# sourceMappingURL=get.js.map