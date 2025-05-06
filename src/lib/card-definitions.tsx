
import React from 'react';
import type { CardType } from '@/lib/game-types';
// Correctly import the icons used
import { CircleDollarSign, Skull, HandCoins, Handshake, Shield } from 'lucide-react';

// Icons remain the same
const DukeIcon = <CircleDollarSign />;
const AssassinIcon = <Skull />;
const CaptainIcon = <HandCoins />;
const AmbassadorIcon = <Handshake />;
const ContessaIcon = <Shield />;

// Use Tailwind background color classes derived from the theme variables
export const cardInfo: Record<CardType, { icon: React.ReactNode; color: string; name: string }> = {
  Duke: { icon: DukeIcon, color: 'bg-primary', name: 'Duque' }, // Uses --primary HSL variable
  Assassin: { icon: AssassinIcon, color: 'bg-gray-700', name: 'Assassino' }, // Keep gray for Assassin for distinction
  Captain: { icon: CaptainIcon, color: 'bg-secondary', name: 'Capitão' }, // Uses --secondary HSL variable
  Ambassador: { icon: AmbassadorIcon, color: 'bg-accent', name: 'Embaixador' }, // Uses --accent HSL variable
  Contessa: { icon: ContessaIcon, color: 'bg-destructive', name: 'Condessa' }, // Uses --destructive HSL variable
};
