import { Component, type ComponentType } from "react";

// AlarmSound importa moduli nativi (expo-audio, react-native-volume-manager)
// assenti in Expo Go, il cui import lancia quando non sono linkati. Lo carichiamo
// con require() protetto: se l'import fallisce restiamo con `Loaded = null` e non
// suoniamo, invece di far cadere l'intera route /alarm.
let Loaded: ComponentType | null = null;
try {
  Loaded = require("./AlarmSound").default;
} catch {
  Loaded = null;
}

interface State {
  failed: boolean;
}

/**
 * SafeAlarmSound — boundary attorno alla sirena d'emergenza.
 *
 * Doppia protezione contro l'assenza dei moduli nativi (es. Expo Go):
 *  - require() protetto sopra → import-time (route non cade su "unmatched route");
 *  - error boundary sotto     → render-time (la schermata alarm resta viva).
 *
 * In entrambi i casi il fallback è: nessun suono. L'emergenza resta visibile e
 * funzionante — la sirena è un plus, non un requisito. Speculare a `SafeMap`.
 */
export default class SafeAlarmSound extends Component<{}, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    /* silenzioso: il fallback (niente suono) è sufficiente */
  }

  render() {
    if (this.state.failed || !Loaded) return null;
    return <Loaded />;
  }
}
