import { ageGate } from './agegate';
import { followOtherTabs } from './ui/theme';

followOtherTabs();

ageGate(() => import('./main'));
