export const QUICK_PAGE_SIZE=30;
export function historyPaging(offset:number,count:number,nextOffset:number|null){
 return {page:Math.floor(offset/QUICK_PAGE_SIZE)+1,showPages:offset>0||nextOffset!==null,previous:Math.max(0,offset-QUICK_PAGE_SIZE),emptyPageOffset:count===0&&offset>0?Math.max(0,offset-QUICK_PAGE_SIZE):offset};
}
