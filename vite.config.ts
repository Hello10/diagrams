import { defineConfig } from "vite-plus";

export default defineConfig({
	staged: {
		"*": "vp check --fix",
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
	lint: {
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		options: { typeAware: true, typeCheck: true },
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
			"no-unused-vars": [
				"warn",
				{
					args: "all",
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
		},
	},
	fmt: {
		useTabs: true,
		printWidth: 80,
		sortImports: {},
		sortPackageJson: false,
		ignorePatterns: ["src/__snapshots__/**", "examples/index.html", "**/*.md"],
	},
});
