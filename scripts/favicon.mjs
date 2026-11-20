// Writes public/favicon.svg from Ghost.exe's sprite.
import { writeFileSync } from "node:fs";
import { ghostSvg } from "../src/sponsor.js";
writeFileSync(new URL("../public/favicon.svg", import.meta.url), ghostSvg("idle", 64).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
