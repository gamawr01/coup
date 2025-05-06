
import React from 'react';
import type { CardType } from '@/lib/game-types';
// Correctly import the icons used
import { CircleDollarSign, Skull, HandCoins, Handshake, Shield } from 'lucide-react';

// Assign icons to variables first (though likely not necessary, might help parser)
const DukeIcon = <CircleDollarSign />;
const AssassinIcon = <Skull />;
const CaptainIcon = <HandCoins />;
const AmbassadorIcon = <Handshake />;
const ContessaIcon = <Shield />;

// Define the card information using the variables
export const cardInfo: Record<CardType, { icon: React.ReactNode; color: string; name: string }> = {
  Duke: { icon: DukeIcon, color: 'bg-purple-600', name: 'Duque' },
  Assassin: { icon: AssassinIcon, color: 'bg-gray-700', name: 'Assassino' }, // Use gray for Assassin based on image
  Captain: { icon: CaptainIcon, color: 'bg-blue-600', name: 'Capitão' },
  Ambassador: { icon: AmbassadorIcon, color: 'bg-green-600', name: 'Embaixador' },
  Contessa: { icon: ContessaIcon, color: 'bg-red-600', name: 'Condessa' }, // Use red for Contessa based on image
};
