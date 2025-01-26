export enum LogLevel {
  Off =     0x00000000,
  Error =   0x00000001,
  Warning = 0x00000002,
  Info =    0x00000004,
  Debug =   0x00000008,
  Midi =    0x00000010,
  All =     0xFFFFFFFF
} 

let logLevel: LogLevel = LogLevel.All;

export function setLogLevel(level: LogLevel): void 
{ 
  logLevel = level; 
}

export function getLogLevel(): LogLevel 
{ 
  return logLevel; 
}

export function shouldLog(level: LogLevel): boolean 
{ 
  return (level & logLevel) === level;
}