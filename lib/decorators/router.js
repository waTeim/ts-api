"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
function router(prefix) {
    return function (target) {
        var original = target;
        var f = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            this.prefix = prefix;
            if (this.prefix.charAt(0) != '/')
                this.prefix = '/' + this.prefix;
            if (this.prefix.charAt(this.prefix.length - 1) == '/')
                this.prefix = this.prefix.substring(0, this.prefix.length - 1);
            return original.apply(this, args);
        };
        // copy prototype so intanceof operator still works
        f.prototype = original.prototype;
        // return new constructor (will override original)
        return f;
    };
}
exports.default = router;
//# sourceMappingURL=router.js.map