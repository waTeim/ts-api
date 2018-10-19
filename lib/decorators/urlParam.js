"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
function urlParam(component) {
    return function (target, propertyKey, parameterIndex) {
        var parms = Reflect.getOwnMetadata("urlParam", target, propertyKey) || [];
        parms.push(parameterIndex);
        Reflect.defineMetadata("urlParam", parms, target, propertyKey);
    };
}
exports.default = urlParam;
//# sourceMappingURL=urlParam.js.map