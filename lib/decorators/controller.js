"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
function controller(path) {
    return function (target) {
        var original = target;
        var f = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            this.path = path;
            if (this.path.charAt(0) != '/')
                this.path = '/' + this.path;
            if (this.path.charAt(this.path.length - 1) == '/')
                this.path = this.path.substring(0, this.path.length - 1);
            return original.apply(this, args);
        };
        // copy prototype so intanceof operator still works
        f.prototype = original.prototype;
        // return new constructor (will override original)
        return f;
    };
}
exports.default = controller;
//# sourceMappingURL=controller.js.map