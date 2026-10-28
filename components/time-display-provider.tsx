'use client';
import { createContext, useContext } from 'react';
import { makeClock } from '../lib/time-display';
export const TimeDisplayContext=createContext(makeClock());
export const useClock=()=>useContext(TimeDisplayContext);
