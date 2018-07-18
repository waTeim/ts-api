"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var verb_1 = require("./verb");
function all(path, errorHandler) {
    return function (target, key, descriptor) {
        if (descriptor === undefined)
            descriptor = Object.getOwnPropertyDescriptor(target, key);
        descriptor.value = verb_1.default(target, key, descriptor.value, errorHandler);
        return descriptor;
    };
}
exports.default = all;
//# sourceMappingURL=all.js.map