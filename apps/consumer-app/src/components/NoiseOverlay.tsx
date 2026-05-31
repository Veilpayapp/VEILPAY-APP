import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Rect, FractalNoise, BackdropFilter, Fill, Blur } from '@shopify/react-native-skia';

interface NoiseOverlayProps {
  opacity?: number;
}

export const NoiseOverlay = ({ opacity = 0.03 }: NoiseOverlayProps) => {
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      <Canvas style={{ flex: 1 }}>
        <Rect x={0} y={0} width={2000} height={3000}>
          <FractalNoise freqX={0.5} freqY={0.5} octaves={2} />
        </Rect>
      </Canvas>
    </View>
  );
};

export const BlurOverlay = ({ blurAmount = 10, color = "rgba(0,0,0,0.2)" }) => {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={{ flex: 1 }}>
        <BackdropFilter filter={<Blur blur={blurAmount} />}>
          <Fill color={color} />
        </BackdropFilter>
      </Canvas>
    </View>
  );
};
