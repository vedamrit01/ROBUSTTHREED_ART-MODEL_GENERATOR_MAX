import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  root:fileURLToPath(new URL('./github-pages',import.meta.url)),
  envDir:fileURLToPath(new URL('./',import.meta.url)),
  // Relative assets work on a repository path, a user site or a custom domain.
  base:'./',
  publicDir:fileURLToPath(new URL('./public',import.meta.url)),
  plugins:[react()],
  resolve:{alias:{'@':fileURLToPath(new URL('./',import.meta.url))}},
  worker:{format:'es'},
  build:{outDir:fileURLToPath(new URL('./dist-pages',import.meta.url)),emptyOutDir:true,target:'es2022'},
});
