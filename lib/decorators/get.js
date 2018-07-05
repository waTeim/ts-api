"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Promise = require('bluebird');
var uuid = require('uuid/v1');
function get(path, errorHandler) {
    return function (target, key, descriptor) {
        if (descriptor === undefined)
            descriptor = Object.getOwnPropertyDescriptor(target, key);
        var originalMethod = descriptor.value;
        descriptor.value = function () {
            var binding = this.getEndpointSignatureBinding();
            var controller = this;
            if (binding != null) {
                var check = binding.check[target.constructor.name + "." + key];
                var valid = check.validate(check.argsToSchema(arguments));
                var args = [];
                if (!valid) {
                    var err = check.validate.errors[0];
                    throw ({ status: 400, message: "parameterList" + err.dataPath + " " + err.message });
                }
            }
            for (var _i = 0; _i < arguments.length; _i++)
                args[_i - 0] = arguments[_i];
            try {
                // note usage of originalMethod here
                var obj_1 = originalMethod.apply(this, args);
                if (obj_1 != null) {
                    if (obj_1.constructor.name == 'Promise') {
                        var promise = new Promise(function (resolve, reject) {
                            obj_1.then(function (value) { resolve(value); }, function (reason) {
                                if (errorHandler != null) {
                                    try {
                                        var errorHandlerResult = errorHandler(reason, controller.req, controller.res, controller.next);
                                        if (errorHandlerResult != null && typeof errorHandlerResult == "object") {
                                            if (errorHandlerResult.status == null)
                                                errorHandlerResult.status = 500;
                                            reject(errorHandlerResult);
                                        }
                                        else
                                            reject({ status: 500, message: errorHandlerResult });
                                    }
                                    catch (e) {
                                        reject(e);
                                    }
                                }
                                else
                                    reject(reason);
                            });
                        });
                        return promise;
                    }
                }
                return new Promise(function (resolve, reject) { resolve(obj_1); });
            }
            catch (e) {
                if (errorHandler != null) {
                    var errorHandlerResult = errorHandler(e, controller.req, controller.res, controller.next);
                    if (errorHandlerResult != null && typeof errorHandlerResult == "object") {
                        if (errorHandlerResult.status == null)
                            errorHandlerResult.status = 500;
                        throw (errorHandlerResult);
                    }
                    else
                        throw ({ status: 500, message: errorHandlerResult });
                }
                throw (e);
            }
        };
        return descriptor;
    };
}
exports.default = get;
//# sourceMappingURL=get.js.map