export function abortError():Error { return new DOMException("Operation aborted","AbortError"); }
export function throwIfAborted(signal?:AbortSignal):void { if(signal?.aborted)throw abortError(); }
/** Even an injected client that ignores cancellation cannot hold a caller open. */
export async function abortable<T>(task:Promise<T>,signal:AbortSignal):Promise<T> {
  throwIfAborted(signal);
  let listener:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{listener=()=>reject(abortError());signal.addEventListener("abort",listener,{once:true});});
  try{return await Promise.race([task,cancelled]);}finally{signal.removeEventListener("abort",listener);}
}
export async function backoff(ms:number,signal:AbortSignal):Promise<void> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await abortable(new Promise<void>(resolve=>{timer=setTimeout(resolve,ms);}),signal);}finally{clearTimeout(timer);}
}
