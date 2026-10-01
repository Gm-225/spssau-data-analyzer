const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('analysisBridge', {
  runQuestionnaireAnalysis: (payload) => ipcRenderer.invoke('analysis:run-questionnaire', payload),
  openArtifact: (artifactPath) => ipcRenderer.invoke('analysis:open-artifact', artifactPath),
  getAmosStatus: () => ipcRenderer.invoke('analysis:get-amos-status'),
  configureAmos: () => ipcRenderer.invoke('analysis:configure-amos'),
});
