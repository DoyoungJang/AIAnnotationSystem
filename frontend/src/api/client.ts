const API='/api/v1'

export class ApiError extends Error{constructor(public status:number, public detail:unknown){super(typeof detail==='string'?detail:typeof detail==='object'&&detail!==null&&'message' in detail?String((detail as {message:unknown}).message):'요청을 처리하지 못했습니다.')}}

export function token(){return sessionStorage.getItem('sonolabel-token')}
export function setToken(value:string|null){if(value)sessionStorage.setItem('sonolabel-token',value);else sessionStorage.removeItem('sonolabel-token')}

export async function request<T>(path:string, init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers);if(token())headers.set('Authorization',`Bearer ${token()}`)
  if(init.body && !(init.body instanceof FormData))headers.set('Content-Type','application/json')
  const response=await fetch(`${API}${path}`,{...init,headers})
  if(!response.ok){let detail:unknown=response.statusText;try{detail=(await response.json()).detail}catch{}throw new ApiError(response.status,detail)}
  if(response.status===204)return undefined as T
  return response.json() as Promise<T>
}

export async function imageUrl(assetId:string,thumbnail=false):Promise<string>{
  const response=await fetch(`${API}/assets/${assetId}/${thumbnail?'thumbnail':'content'}`,{headers:{Authorization:`Bearer ${token()}`}})
  if(!response.ok)throw new ApiError(response.status,'영상을 불러올 수 없습니다.')
  return URL.createObjectURL(await response.blob())
}

export async function downloadExport(exportId:string,filename:string):Promise<void>{
  const response=await fetch(`${API}/exports/${exportId}/download`,{headers:{Authorization:`Bearer ${token()}`}})
  if(!response.ok){let detail:unknown='내보내기 파일을 다운로드할 수 없습니다.';try{detail=(await response.json()).detail}catch{}throw new ApiError(response.status,detail)}
  const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url)
}
