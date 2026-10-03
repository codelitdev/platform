#!/usr/bin/env node
// Committed shim so workspace installs can link the bin before dist/ is built.
import "../dist/cli/bin.js";
