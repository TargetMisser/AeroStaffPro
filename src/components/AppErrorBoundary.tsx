import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { recordRuntimeError } from '../utils/runtimeDiagnostics';

type Props = { children: React.ReactNode };
type State = { error: Error | null; resetKey: number };

/**
 * Last line of defence for render errors. Without it, one malformed provider
 * response or cached record closes the whole app (and can do so on every launch
 * while the bad data is cached). It deliberately avoids the theme/language
 * contexts, since a failing provider may be what threw.
 */
export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    recordRuntimeError(error, 'render', false).catch(() => {});
  }

  private retry = () => {
    this.setState(prev => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.root}>
          <Text style={styles.title}>Qualcosa è andato storto</Text>
          <Text style={styles.body}>
            Una schermata ha avuto un errore imprevisto. I tuoi dati sono al sicuro.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.retry}
            accessibilityRole="button"
            accessibilityLabel="Riprova"
          >
            <Text style={styles.buttonText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#0B1114',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: '#B8C2C8',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#F47B16',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
