import { fmt, lint, staged } from "@hello10/config-vite-plus/base";
import { defineConfig } from "vite-plus";

export default defineConfig({
	staged,
	lint,
	fmt: {
		...fmt,
		ignorePatterns: [
			...fmt.ignorePatterns,
			"src/__snapshots__/**",
			"examples/index.html",
		],
	},
	test: {
		globals: true,
		include: ["src/**/*.test.ts"],
	},
	pack: {
		entry: ["src/index.ts"],
		format: ["esm"],
		dts: { generator: "tsgo" },
		sourcemap: true,
		target: "es2022",
		// Keep dist/index.js and dist/index.d.ts, which package.json exports.
		fixedExtension: false,
		exports: true,
	},
});
