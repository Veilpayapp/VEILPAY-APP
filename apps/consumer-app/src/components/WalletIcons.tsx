import React from 'react';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

export const MetaMaskIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 318.6 318.6">
    <Path fill="#e2761b" stroke="#e2761b" strokeLinecap="round" strokeLinejoin="round" d="m274.1 35.5-99.5 73.9L193 65.8z"/>
    <Path fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" d="m44.4 35.5 98.7 74.6-17.5-44.3zm193.9 171.3-26.5 40.6 56.7 15.6 16.3-55.3zm-204.4.9L50.1 263l56.7-15.6-26.5-40.6z" />
    <Path fill="#e4761b" stroke="#e4761b" strokeLinecap="round" strokeLinejoin="round" d="m103.6 138.2-15.8 23.9 56.3 2.5-2-60.5zm111.3 0-39-34.8-1.3 61.2 56.2-2.5zM106.8 247.4l33.8-16.5-29.2-22.8zm71.1-16.5 33.9 16.5-4.7-39.3z"/>
    <Path fill="#d7c1b3" stroke="#d7c1b3" strokeLinecap="round" strokeLinejoin="round" d="m211.8 247.4-33.9-16.5 2.7 22.1-.3 9.3zm-105 0 31.5 14.9-.2-9.3 2.5-22.1z"/>
    <Path fill="#233447" stroke="#233447" strokeLinecap="round" strokeLinejoin="round" d="m138.8 193.5-28.2-8.3 19.9-9.1zm40.9 0 8.3-17.4 20 9.1z"/>
    <Path fill="#cd6116" stroke="#cd6116" strokeLinecap="round" strokeLinejoin="round" d="m106.8 247.4 4.8-40.6-31.3.9zM207 206.8l4.8 40.6 26.5-39.7zm23.8-44.7-56.2 2.5 5.2 28.9 8.3-17.4 20 9.1zm-120.2 23.1 20-9.1 8.2 17.4 5.3-28.9-56.3-2.5z"/>
    <Path fill="#e4751f" stroke="#e4751f" strokeLinecap="round" strokeLinejoin="round" d="m87.8 162.1 23.6 46-.8-22.9zm120.3 23.1-1 22.9 23.7-46zm-64-20.6-5.3 28.9 6.6 34.1 1.5-44.9zm30.5 0-2.7 18 1.2 45 6.7-34.1z"/>
    <Path fill="#f6851b" stroke="#f6851b" strokeLinecap="round" strokeLinejoin="round" d="m179.8 193.5-6.7 34.1 4.8 3.3 29.2-22.8 1-22.9zm-69.2-8.3.8 22.9 29.2 22.8 4.8-3.3-6.6-34.1z"/>
    <Path fill="#c0ad9e" stroke="#c0ad9e" strokeLinecap="round" strokeLinejoin="round" d="m180.3 262.3.3-9.3-2.5-2.2h-37.7l-2.3 2.2.2 9.3-31.5-14.9 11 9 22.3 15.5h38.3l22.4-15.5 11-9z"/>
    <Path fill="#161616" stroke="#161616" strokeLinecap="round" strokeLinejoin="round" d="m177.9 230.9-4.8-3.3h-27.7l-4.8 3.3-2.5 22.1 2.3-2.2h37.7l2.5 2.2z"/>
    <Path fill="#763d16" stroke="#763d16" strokeLinecap="round" strokeLinejoin="round" d="m278.3 114.2 8.5-40.8-12.7-37.9-96.2 71.4 37 31.3 52.3 15.3 11.6-13.5-5-3.6 8-7.3-6.2-4.8 8-6.1zM31.8 73.4l8.5 40.8-5.4 4 8 6.1-6.1 4.8 8 7.3-5 3.6 11.5 13.5 52.3-15.3 37-31.3-96.2-71.4z"/>
    <Path fill="#f6851b" stroke="#f6851b" strokeLinecap="round" strokeLinejoin="round" d="m267.2 153.5-52.3-15.3 15.9 23.9-23.7 46 31.2-.4h46.5zm-163.6-15.3-52.3 15.3-17.4 54.2h46.4l31.1.4-23.6-46zm71 26.4 3.3-57.7 15.2-41.1h-67.5l15 41.1 3.5 57.7 1.2 18.2.1 44.8h27.7l.2-44.8z"/>
  </Svg>
);

export const WalletConnectIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} fill="none" viewBox="0 0 400 400">
    // eslint-disable-next-line rendering-svg-precision
    <Circle cx="200" cy="200" fill="#3396ff" r="199.5" />
    // eslint-disable-next-line rendering-svg-precision
    <Path fill="#fff" d="m122.519 148.965c42.791-41.729 112.171-41.729 154.962 0l5.15 5.022c2.14 2.086 2.14 5.469 0 7.555l-17.617 17.18c-1.07 1.043-2.804 1.043-3.874 0l-7.087-6.911c-29.853-29.111-78.253-29.111-108.106 0l-7.59 7.401c-1.07 1.043-2.804 1.043-3.874 0l-17.617-17.18c-2.14-2.086-2.14-5.469 0-7.555zm191.397 35.529 15.679 15.29c2.14 2.086 2.14 5.469 0 7.555l-70.7 68.944c-2.139 2.087-5.608 2.087-7.748 0l-50.178-48.931c-.535-.522-1.402-.522-1.937 0l-50.178 48.931c-2.139 2.087-5.608 2.087-7.748 0l-70.7015-68.945c-2.1396-2.086-2.1396-5.469 0-7.555l15.6795-15.29c2.1396-2.086 5.6085-2.086 7.7481 0l50.1789 48.932c.535.522 1.402.522 1.937 0l50.177-48.932c2.139-2.087 5.608-2.087 7.748 0l50.179 48.932c.535.522 1.402.522 1.937 0l50.179-48.931c2.139-2.087 5.608-2.087 7.748 0z" />
  </Svg>
);

// Trust Wallet — brand shield with the two-tone blue gradient.
export const TrustWalletIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 512 512" fill="none">
    <Defs>
      <LinearGradient id="trustShield" x1="256" y1="40" x2="256" y2="484" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#0500FF" />
        <Stop offset="0.6" stopColor="#3375BB" />
      </LinearGradient>
    </Defs>
    <Path fill="url(#trustShield)" d="M256 40 88 104v192c0 100 80 156 168 188 88-32 168-88 168-188V104L256 40Z" />
    {/* Lighter right-half highlight = Trust's signature two-tone shield */}
    <Path fill="#fff" fillOpacity={0.18} d="M256 40v444c88-32 168-88 168-188V104L256 40Z" />
  </Svg>
);

// Phantom — purple squircle with the white ghost (eyes are cut-outs showing the bg).
export const PhantomIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 128 128" fill="none">
    <Rect width="128" height="128" rx="30" fill="#AB9FF2" />
    <Path
      fill="#fff"
      d="M110 66.5c0-25.2-20.4-45.6-45.6-45.6C40 20.9 20 40.4 19.1 64.6c0 .5 0 .9 0 1.4v34.9c0 2 2.3 3.1 3.9 1.8l9.3-7.6c1.4-1.1 3.4-1 4.6.3l7.9 8.4c1.3 1.4 3.5 1.4 4.8 0l8-8.5c1.2-1.3 3.3-1.3 4.6 0l8 8.5c1.3 1.4 3.5 1.4 4.8 0l7.9-8.4c1.2-1.3 3.2-1.4 4.6-.3l9.3 7.6c1.6 1.3 3.9.2 3.9-1.8V66.5Z"
    />
    <Circle cx="47" cy="59" r="6.5" fill="#AB9FF2" />
    <Circle cx="73" cy="59" r="6.5" fill="#AB9FF2" />
  </Svg>
);

// Petra — black squircle with the white "P" monogram.
export const PetraIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 128 128" fill="none">
    <Rect width="128" height="128" rx="30" fill="#000000" />
    <Path
      fill="#fff"
      d="M46 36h30c14 0 24 10 24 24s-10 24-24 24H60v24H46V36Zm14 34h14c6 0 10-4 10-10s-4-10-10-10H60v20Z"
    />
  </Svg>
);

// LOBSTR — brand-blue squircle with a stylized white lobster (body + two claws).
export const LobstrIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 128 128" fill="none">
    <Rect width="128" height="128" rx="30" fill="#0F9BF0" />
    <Path
      fill="#fff"
      d="M64 32c-5 0-9 4-9 9 0 3 1.6 5.7 4 7.3L57 58c-6 1-11 6-11 12v6c0 12 8 20 18 20s18-8 18-20v-6c0-6-5-11-11-12l-2-9.7c2.4-1.6 4-4.3 4-7.3 0-5-4-9-9-9Z"
    />
    <Path fill="#fff" d="M40 54c-5-3-9-2-11 2s0 8 5 10l10 4-1-9-3-7Zm48 0c5-3 9-2 11 2s0 8-5 10l-10 4 1-9 3-7Z" />
  </Svg>
);

// Ledger — black squircle with the white bracket/frame mark.
export const LedgerIcon = ({ width = 24, height = 24 }: { width?: number, height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 128 128" fill="none">
    <Rect width="128" height="128" rx="30" fill="#000000" />
    <Path
      fill="#fff"
      d="M38 38h34v11H49v23H38V38Zm52 0v34H79V49H56V38h34ZM38 79h11v12h23v11H38V79Zm52 0v23H56V91h23V79h11Z"
    />
  </Svg>
);
