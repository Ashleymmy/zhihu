import { createHash } from 'node:crypto';
import { AppError } from '../middleware/errors';
export function cash(value:string,signed=false):bigint{
 if(!(signed?/^-?\d{1,16}(\.\d{1,4})?$/:/^\d{1,16}(\.\d{1,4})?$/).test(value))throw new AppError(422,42200,'请输入有效金额，最多保留四位小数');
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
 return (BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')))*(negative?-1n:1n);
}
export function cashText(n:bigint){const x=n<0n?-n:n;if(x>=10n**20n)throw new AppError(422,42200,'金额超出范围');return(n<0n?'-':'')+x/10000n+'.'+String(x%10000n).padStart(4,'0');}
export const checksum=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

