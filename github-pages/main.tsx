import {createRoot} from 'react-dom/client';
import ClientPortal from '../components/client-portal';
import '../app/globals.css';
import '../app/client-access.css';

const root=document.getElementById('root');
if(!root)throw new Error('The studio could not find its mounting point.');
createRoot(root).render(<ClientPortal/>);
