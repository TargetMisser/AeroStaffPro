import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import DesignDirectionPreview from '../../src/dev/DesignDirectionPreview';
import { DESIGN_DIRECTIONS } from '../../src/dev/designDirections';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070A' },
  content: { padding: 18, gap: 18 },
});

function StoryFrame({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

export default {
  title: 'AeroStaff/Design directions',
};

export const AviationGlass = () => (
  <StoryFrame>
    <DesignDirectionPreview direction={DESIGN_DIRECTIONS[0]} />
  </StoryFrame>
);

export const OperationsBoard = () => (
  <StoryFrame>
    <DesignDirectionPreview direction={DESIGN_DIRECTIONS[1]} />
  </StoryFrame>
);

export const SunsetPremium = () => (
  <StoryFrame>
    <DesignDirectionPreview direction={DESIGN_DIRECTIONS[2]} />
  </StoryFrame>
);

export const AllDirections = () => (
  <StoryFrame>
    {DESIGN_DIRECTIONS.map(direction => (
      <View key={direction.id}>
        <DesignDirectionPreview direction={direction} compact />
      </View>
    ))}
  </StoryFrame>
);
