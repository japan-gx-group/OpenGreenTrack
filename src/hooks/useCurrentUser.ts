'use client';

import { useContext } from 'react';
import { CurrentUserContext } from '@/contexts/currentUserContextValue';

export const useCurrentUser = () => {
  const context = useContext(CurrentUserContext);

  if (!context) {
    throw new Error('useCurrentUser must be used within CurrentUserProvider.');
  }

  return context;
};
