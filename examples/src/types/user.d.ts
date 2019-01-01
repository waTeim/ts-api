
export interface IUser {
    /** @format {uuid} */
    id: string;
    name: string;
    isActive?: boolean;
}

export interface IListQuery {
    sort?: string;
    /** @type {integer} */
    limit?: number;
}
