import type { RenderedChunk } from 'rollup';
import type { BuildInternals } from '../core/build/internal';

import * as path from 'path';
import esbuild from 'esbuild';
import { Plugin as VitePlugin } from '../core/vite';
import { STYLE_EXTENSIONS } from '../core/ssr/css.js';

const PLUGIN_NAME = '@astrojs/rollup-plugin-build-css';

// This is a virtual module that represents the .astro <style> usage on a page
const ASTRO_STYLE_PREFIX = '@astro-inline-style';

const ASTRO_PAGE_STYLE_PREFIX = '@astro-page-all-styles';

const cssRe = new RegExp(
	`\\.(${Array.from(STYLE_EXTENSIONS)
		.map((s) => s.slice(1))
		.join('|')})($|\\?)`
);
const isCSSRequest = (request: string): boolean => cssRe.test(request);

export function getAstroPageStyleId(pathname: string) {
	let styleId = ASTRO_PAGE_STYLE_PREFIX + pathname;
	if (styleId.endsWith('/')) {
		styleId += 'index';
	}
	styleId += '.js';
	return styleId;
}

export function getAstroStyleId(pathname: string) {
	let styleId = ASTRO_STYLE_PREFIX + pathname;
	if (styleId.endsWith('/')) {
		styleId += 'index';
	}
	return styleId;
}

export function getAstroStylePathFromId(id: string) {
	return id.substr(ASTRO_STYLE_PREFIX.length + 1);
}

function isStyleVirtualModule(id: string) {
	return id.startsWith(ASTRO_STYLE_PREFIX);
}

function isPageStyleVirtualModule(id: string) {
	return id.startsWith(ASTRO_PAGE_STYLE_PREFIX);
}

interface PluginOptions {
	internals: BuildInternals;
}

export function rollupPluginAstroBuildCSS(options: PluginOptions): VitePlugin {
	const { internals } = options;
	const styleSourceMap = new Map<string, string>();

	return {
		name: PLUGIN_NAME,

		configResolved(resolvedConfig) {
			// Our plugin needs to run before `vite:css-post` which does a lot of what we do
			// for bundling CSS, but since we need to control CSS we should go first.
			// We move to right before the vite:css-post plugin so that things like the
			// Vue plugin go before us.
			const plugins = resolvedConfig.plugins as VitePlugin[];
			const viteCSSPostIndex = resolvedConfig.plugins.findIndex((p) => p.name === 'vite:css-post');
			if (viteCSSPostIndex !== -1) {
				const viteCSSPost = plugins[viteCSSPostIndex];
				// Prevent this plugin's bundling behavior from running since we need to
				// do that ourselves in order to handle updating the HTML.
				delete viteCSSPost.renderChunk;
				delete viteCSSPost.generateBundle;

				// Move our plugin to be right before this one.
				const ourIndex = plugins.findIndex((p) => p.name === PLUGIN_NAME);
				const ourPlugin = plugins[ourIndex];

				// Remove us from where we are now and place us right before the viteCSSPost plugin
				plugins.splice(ourIndex, 1);
				plugins.splice(viteCSSPostIndex - 1, 0, ourPlugin);
			}
		},

		async resolveId(id) {
			if (isPageStyleVirtualModule(id)) {
				return id;
			}
			if (isStyleVirtualModule(id)) {
				return id;
			}
			return undefined;
		},

		async load(id) {
			if (isPageStyleVirtualModule(id)) {
				return internals.astroPageStyleMap.get(id) || null;
			}
			if (isStyleVirtualModule(id)) {
				return internals.astroStyleMap.get(id) || null;
			}
			return null;
		},

		async transform(value, id) {
			if (isStyleVirtualModule(id)) {
				styleSourceMap.set(id, value);
			}
			if (isCSSRequest(id)) {
				styleSourceMap.set(id, value);
			}
			return null;
		},

		async renderChunk(_code, chunk) {
			let chunkCSS = '';
			let isPureCSS = true;
			for (const [id] of Object.entries(chunk.modules)) {
				if (!isCSSRequest(id) && !isPageStyleVirtualModule(id)) {
					isPureCSS = false;
				}
				if (styleSourceMap.has(id)) {
					chunkCSS += styleSourceMap.get(id)!;
				}
			}

			if (!chunkCSS) return null; // don’t output empty .css files

			if (isPureCSS) {
				internals.pureCSSChunks.add(chunk);
			}

			const { code: minifiedCSS } = await esbuild.transform(chunkCSS, {
				loader: 'css',
				minify: true,
			});
			const referenceId = this.emitFile({
				name: chunk.name + '.css',
				type: 'asset',
				source: minifiedCSS,
			});

			internals.chunkToReferenceIdMap.set(chunk.fileName, referenceId);
			if (chunk.type === 'chunk') {
				const fileName = this.getFileName(referenceId);
				if (chunk.facadeModuleId) {
					const facadeId = chunk.facadeModuleId!;
					if (!internals.facadeIdToAssetsMap.has(facadeId)) {
						internals.facadeIdToAssetsMap.set(facadeId, []);
					}
					internals.facadeIdToAssetsMap.get(facadeId)!.push(fileName);
				}
			}

			return null;
		},

		// Delete CSS chunks so JS is not produced for them.
		generateBundle(opts, bundle) {
			const hasPureCSSChunks = internals.pureCSSChunks.size;
			const pureChunkFilenames = new Set([...internals.pureCSSChunks].map((chunk) => chunk.fileName));
			const emptyChunkFiles = [...pureChunkFilenames]
				.map((file) => path.basename(file))
				.join('|')
				.replace(/\./g, '\\.');
			const emptyChunkRE = new RegExp(opts.format === 'es' ? `\\bimport\\s*"[^"]*(?:${emptyChunkFiles})";\n?` : `\\brequire\\(\\s*"[^"]*(?:${emptyChunkFiles})"\\);\n?`, 'g');

			for (const [chunkId, chunk] of Object.entries(bundle)) {
				if (chunk.type === 'chunk') {
					// If the chunk has a facadeModuleId it is an entrypoint chunk.
					// This find shared chunks of CSS and adds them to the main CSS chunks,
					// so that shared CSS is added to the page.
					if (chunk.facadeModuleId) {
						if (!internals.facadeIdToAssetsMap.has(chunk.facadeModuleId)) {
							internals.facadeIdToAssetsMap.set(chunk.facadeModuleId, []);
						}
						const assets = internals.facadeIdToAssetsMap.get(chunk.facadeModuleId)!;
						const assetSet = new Set(assets);
						for (const imp of chunk.imports) {
							if (internals.chunkToReferenceIdMap.has(imp) && !pureChunkFilenames.has(imp)) {
								const referenceId = internals.chunkToReferenceIdMap.get(imp)!;
								const fileName = this.getFileName(referenceId);
								if (!assetSet.has(fileName)) {
									assetSet.add(fileName);
									assets.push(fileName);
								}
							}
						}
					}

					// Removes imports for pure CSS chunks.
					if (hasPureCSSChunks) {
						if (internals.pureCSSChunks.has(chunk)) {
							// Delete pure CSS chunks, these are JavaScript chunks that only import
							// other CSS files, so are empty at the end of bundling.
							delete bundle[chunkId];
						} else {
							// Remove any pure css chunk imports from JavaScript.
							// Note that this code comes from Vite's CSS build plugin.
							chunk.code = chunk.code.replace(
								emptyChunkRE,
								// remove css import while preserving source map location
								(m) => `/* empty css ${''.padEnd(m.length - 15)}*/`
							);
						}
					}
				}
			}
		},
	};
}
