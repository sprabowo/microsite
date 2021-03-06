import { resolve, relative } from "path";
import module from "module";
const { createRequire } = module;
const require = createRequire(import.meta.url);

import { fileExists } from "./fs.js";
import { createConfiguration } from "snowpack";
import cc from "cosmiconfig";
const { cosmiconfig } = cc;
const _config = require("microsite/assets/snowpack.config.cjs");

const pkg = require(resolve(process.cwd(), "package.json"));
// const deps = Object.keys(
//   pkg.dependencies || {}
// );
const DEFAULT_BASE_PATH = pkg.homepage || '/';

export function resolveNormalizedBasePath(args: { ['--base-path']?: string, [key: string]: any }) {
  let basePath = args['--base-path'] ?? DEFAULT_BASE_PATH;
  return basePath === '/' ? basePath : `/${basePath.replace(/^\//, '').replace(/\/$/, '')}/`;
} 

async function hasPostCSSConfig() {
  try {
    const explorer = cosmiconfig("postcss");
    const result = await explorer.search();
    if (result.filepath) return true;
  } catch (e) {}
  return false;
}

export async function loadConfiguration(mode: "dev" | "build") {
  const [snowpackconfigPath, tsconfigPath, usesPostCSS] = await Promise.all([
    findSnowpackConfig(),
    findTsOrJsConfig(),
    hasPostCSSConfig(),
  ]);
  const aliases = tsconfigPath
    ? resolveTsconfigPathsToAlias({ tsconfigPath })
    : {};
  const userConfig = snowpackconfigPath ? require(snowpackconfigPath) : {};

  const additionalPlugins = usesPostCSS ? ["@snowpack/plugin-postcss"] : [];

  switch (mode) {
    case "dev":
      return createConfiguration({
        ...userConfig,
        ..._config,
        plugins: [...additionalPlugins, ..._config.plugins, ...(userConfig.plugins ?? [])],
        alias: {
          ...(userConfig.aliases ?? {}),
          ...aliases,
          ...(_config.alias ?? {}),
          "microsite/hydrate": "microsite/client/hydrate",
        },
        installOptions: {
          ...(userConfig.installOptions ?? {}),
          ..._config.installOptions,
          externalPackage: ["/web_modules/microsite/_error.js"],
        },
      });
    case "build":
      return createConfiguration({
        ...userConfig,
        ..._config,
        plugins: [...additionalPlugins, ..._config.plugins, ...(userConfig.plugins ?? [])],
        alias: {
          ...(userConfig.aliases ?? {}),
          ...aliases,
          ...(_config.alias ?? {}),
        },
        installOptions: {
          ...(userConfig.installOptions ?? {}),
          ..._config.installOptions,
          rollup: {
            ...(userConfig.installOptions?.rollup ?? {}),
            ...(_config.installOptions?.rollup ?? {}),
            plugins: [
              ...(userConfig.installOptions?.rollup?.plugins ?? []),
              { 
                name: '@microsite/auto-external',
                options(opts) {
                  return Object.assign({}, opts, { external: (source: string) => source.startsWith('preact') });
                }
              }
            ],
          },
          externalPackage: [
            ...(userConfig.installOptions?.externalPackage ?? []),
            ..._config.installOptions.externalPackage,
          ].filter((v) => v !== "preact"),
        },
      });
  }
}

const findSnowpackConfig = async () => {
  const cwd = process.cwd();
  const snowpack = resolve(cwd, './snowpack.config.cjs');
  if (await fileExists(snowpack)) return snowpack;
  return null;
}

const findTsOrJsConfig = async () => {
  const cwd = process.cwd();
  const tsconfig = resolve(cwd, "./tsconfig.json");
  if (await fileExists(tsconfig)) return tsconfig;
  const jsconfig = resolve(cwd, "./jsconfig.json");
  if (await fileExists(jsconfig)) return jsconfig;
  return null;
};

function resolveTsconfigPathsToAlias({
  tsconfigPath = "./tsconfig.json",
} = {}) {
  let { baseUrl, paths } = require(tsconfigPath)?.compilerOptions ?? {};
  if (!(baseUrl && paths)) return {};

  baseUrl = resolve(process.cwd(), baseUrl);

  const aliases = {};

  Object.keys(paths).forEach((item) => {
    const key = item.replace("/*", "");
    const value =
      "./" +
      relative(
        process.cwd(),
        resolve(baseUrl, paths[item][0].replace("/*", "").replace("*", ""))
      );

    aliases[key] = value;
  });

  return aliases;
}
