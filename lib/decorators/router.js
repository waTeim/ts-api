"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
function router(prefix) {
    return function (target) { target.prefix = prefix; console.log("setting target.prefix = ", prefix); };
}
exports.default = router;
//# sourceMappingURL=router.js.map