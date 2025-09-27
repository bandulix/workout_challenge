export const loadState = () => {
  try {
    const serialized = localStorage.getItem('appState');
    return serialized ? JSON.parse(serialized) : undefined;
  } catch {
    return undefined;
  }
};

export const saveState = (state) => {
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem('appState', serialized);
  } catch {
    // Ignore write errors
  }
};