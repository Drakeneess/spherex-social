/** Hashtags in the caption are the source of truth, not a second hidden list. */
const REGEX=/(?<![\p{L}\p{N}_#])#([\p{L}\p{N}][\p{L}\p{N}_]{1,29})/gu;
const VALID=/^[\p{L}\p{N}][\p{L}\p{N}_]{1,29}$/u;

export function extractPostHashtags(value:string):string[]{
  return [...new Set([...value.matchAll(REGEX)]
    .map(match=>match[1].toLocaleLowerCase()).filter(tag=>tag.length<=30))];
}
export function validHashtag(value:string):string|null{
  const tag=value.trim().replace(/^#/,'').toLocaleLowerCase();
  return tag.length<=30&&VALID.test(tag)?tag:null;
}
