"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ControllerBase
 *
 * A baseclass to coordinate ts-api REST endpoint callback and typechecks
 * by simply declaring a string valued id. The class also declares a placeholder
 * for coordination via context.  Controller classes should derive from this
 * class. Derived classes will automatically be constructed from these values.
 */
var ControllerBase = /** @class */ (function () {
    function ControllerBase(context, binding, req, res, next) {
        this.context = context;
        this.binding = binding;
        this.req = req;
        this.res = res;
        this.next = next;
    }
    ControllerBase.prototype.getEndpointSignatureBinding = function () { return this.binding; };
    return ControllerBase;
}());
exports.default = ControllerBase;
//# sourceMappingURL=ControllerBase.js.map