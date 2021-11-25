import { Plugin } from 'esbuild';
import { AcceptedPlugin } from 'postcss';
import modules from 'postcss-modules';


export default function postcssPlugin (options?: PluginOptions): Plugin;

export interface PluginOptions {
	cache?: boolean;
	modules?: boolean | Parameters<modules>[0];
	plugins?: AcceptedPlugin[];
}
