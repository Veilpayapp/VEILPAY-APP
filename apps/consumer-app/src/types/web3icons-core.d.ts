/**
 * Type shim for @web3icons/core's per-icon SVG modules.
 *
 * The package ships pre-compiled `.svg.js` files that export the raw SVG
 * markup as a default-exported string, but it does not ship corresponding
 * `.d.ts` declarations. We render those strings via `<SvgXml />` from
 * react-native-svg, so all we need is to tell TypeScript that the default
 * export is a string.
 */
declare module '@web3icons/core/svgs/networks/branded/*.svg.js' {
  const svg: string;
  export default svg;
}

declare module '@web3icons/core/svgs/networks/mono/*.svg.js' {
  const svg: string;
  export default svg;
}

declare module '@web3icons/core/svgs/networks/background/*.svg.js' {
  const svg: string;
  export default svg;
}

declare module '@web3icons/core/svgs/tokens/branded/*.svg.js' {
  const svg: string;
  export default svg;
}

declare module '@web3icons/core/svgs/tokens/mono/*.svg.js' {
  const svg: string;
  export default svg;
}

declare module '@web3icons/core/svgs/tokens/background/*.svg.js' {
  const svg: string;
  export default svg;
}

declare module '@web3icons/core/svgs/wallets/branded/*.svg.js' {
  const svg: string;
  export default svg;
}
