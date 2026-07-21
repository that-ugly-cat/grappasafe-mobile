import { Component } from "react";
import { View, Text, StyleSheet } from "react-native";
import OfflineMap from "./OfflineMap";
import { AreaConfig } from "../lib/api";
import { t } from "../lib/i18n";

interface Props {
  area: AreaConfig;
  offlineReady: boolean;
  track?: { latitude: number; longitude: number }[];
  style?: object;
}
interface State {
  failed: boolean;
}

// react-native-maps è un modulo nativo: se non è presente nel runtime (es.
// Expo Go senza la mappa) il render di MapView lancia. L'error boundary evita
// che questo faccia cadere l'intera schermata di tracking, che è critica.
export default class SafeMap extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    /* silenzioso: il fallback è sufficiente */
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={[styles.fallback, this.props.style]}>
          <Text style={styles.text}>{t("map.unavailable")}</Text>
          <Text style={styles.sub}>{t("map.needDevBuild")}</Text>
        </View>
      );
    }
    return <OfflineMap {...this.props} />;
  }
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#12121f",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a44",
    padding: 16,
  },
  text: { color: "#aaa", fontSize: 14 },
  sub: { color: "#666", fontSize: 12, marginTop: 4 },
});
