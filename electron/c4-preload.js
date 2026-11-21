const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('c4',{import:()=>ipcRenderer.invoke('c4:import'),list:()=>ipcRenderer.invoke('c4:list'),detail:id=>ipcRenderer.invoke('c4:detail',id)});
