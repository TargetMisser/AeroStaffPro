import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { getAirlineMonogram } from '../../utils/airlineBranding';

export function LogoPill({ iataCode, airlineName, color }: { iataCode: string; airlineName: string; color: string }) {
  const [err, setErr] = useState(false);
  const uri = `https://pics.avs.io/160/60/${(iataCode || '').toUpperCase()}.png`;
  const initials = airlineName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  if (iataCode && !err) {
    return (
      <View style={{ width: 52, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <Image source={{ uri }} style={{ width: 44, height: 26 }} resizeMode="contain" onError={() => setErr(true)} />
      </View>
    );
  }
  return (
    <View style={{ width: 52, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color, fontWeight: '800', fontSize: 11 }}>{initials}</Text>
    </View>
  );
}

export function AirlineFilterLogo({
  iataCode,
  label,
  color,
}: {
  iataCode: string;
  label: string;
  color: string;
}) {
  const [err, setErr] = useState(false);
  const logoUri = iataCode ? `https://pics.avs.io/160/60/${iataCode.toUpperCase()}.png` : '';
  const monogram = getAirlineMonogram(label);
  if (iataCode && !err) {
    return (
      <View style={{ width: 44, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        <Image source={{ uri: logoUri }} style={{ width: 38, height: 24 }} resizeMode="contain" onError={() => setErr(true)} />
      </View>
    );
  }

  return (
    <View style={{ width: 44, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.94)', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color, fontWeight: '900', fontSize: 12, letterSpacing: 0.4 }}>{monogram}</Text>
    </View>
  );
}
