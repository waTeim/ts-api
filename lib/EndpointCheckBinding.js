"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var uuid = require('uuid/v1');
var EndpointCheckBinding = /** @class */ (function () {
    function EndpointCheckBinding(check) {
        this.check = check;
        this.id = uuid();
    }
    return EndpointCheckBinding;
}());
exports.default = EndpointCheckBinding;
//# sourceMappingURL=EndpointCheckBinding.js.map