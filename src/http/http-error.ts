export class HttpError extends Error {
  constructor(public readonly status:number,public readonly method:string,public readonly url:string,public readonly retryAfterMs?:number,public readonly responseBody?:string,public readonly responseContentType?:string,public readonly safeMessage=`HTTP request failed with status ${status}`){super(safeMessage);this.name="HttpError";}
  get retryable():boolean{return this.status===408||this.status===409||this.status===425||this.status===429||this.status>=500;}
}
