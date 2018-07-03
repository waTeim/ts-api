"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ControllerBase
 *
 * A baseclass to coordinate ts-api REST endpoint callback and typechecks
 * by simply declaring a string valued id. The class also declares a placeholder
 * for express coordination via app.  Controller classes should derive from this
 * class. Derived classes will automatically be constructed from these values.
 */
var ControllerBase = /** @class */ (function () {
    function ControllerBase(app, binding) {
        this.app = app;
        this.binding = binding;
    }
    return ControllerBase;
}());
exports.default = ControllerBase;
//# sourceMappingURL=ControllerBase.js.map